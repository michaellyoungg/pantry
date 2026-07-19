package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"pantry/apps/recipe-service/internal/recipe"
	"pantry/apps/recipe-service/internal/telemetry"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	// JSON to stdout: the container runtime collects it, and Alloy ships it to
	// Loki. Trace stamping makes each line pivot to its trace in Tempo.
	slog.SetDefault(slog.New(telemetry.NewTraceHandler(
		slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}),
	)))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}

	// Init before the store so the pgx tracer (BL-0027) sees a real provider.
	shutdownTelemetry, err := telemetry.Init(context.Background(), "recipe-service")
	if err != nil {
		// Telemetry must never stop the service from serving traffic.
		slog.Warn("telemetry disabled", "err", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTelemetry(ctx); err != nil {
			slog.Warn("telemetry shutdown", "err", err)
		}
	}()

	var store recipe.Store
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		pg, err := recipe.NewPostgresStore(context.Background(), dsn)
		if err != nil {
			return fmt.Errorf("postgres: %w", err)
		}
		defer pg.Close()
		store = pg
		slog.Info("store selected", "kind", "postgres")
	} else {
		store = recipe.NewMemoryStore()
		slog.Info("store selected", "kind", "memory", "reason", "DATABASE_URL unset")
	}

	secret := os.Getenv("RECIPE_SERVICE_SECRET")
	if secret == "" {
		return errors.New("RECIPE_SERVICE_SECRET is required")
	}

	var extractor recipe.Extractor
	if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
		extractor = recipe.NewClaudeExtractor(apiKey)
		slog.Info("recipe import: LLM fallback enabled")
	} else {
		slog.Info("recipe import: LLM fallback disabled", "reason", "ANTHROPIC_API_KEY unset")
	}
	importer := recipe.NewImporter(recipe.NewHTTPFetcher(), extractor)
	handler := recipe.NewRouterWithImporter(store, secret, importer)

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Stop trapping the interrupt signals once we begin shutting down, so a
	// second Ctrl-C / SIGTERM force-quits instead of being swallowed.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		slog.Info("recipe-service listening", "port", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return fmt.Errorf("server: %w", err)
	case <-ctx.Done():
		stop()
		slog.Info("shutdown signal received; draining connections")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("graceful shutdown: %w", err)
		}
		slog.Info("shutdown complete")
		return nil
	}
}
