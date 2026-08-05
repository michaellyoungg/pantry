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

	"pantry/apps/recipe-service/internal/nutrition"
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
	// nutritionCache persists the ingredient -> food mapping when Postgres is
	// available; without it nutrition still works, it just re-looks-up per
	// process.
	var nutritionCache nutrition.Cache = nutrition.NewMemoryCache()
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		pg, err := recipe.NewPostgresStore(context.Background(), dsn)
		if err != nil {
			return fmt.Errorf("postgres: %w", err)
		}
		defer pg.Close()
		store = pg
		slog.Info("store selected", "kind", "postgres")

		pgCache := nutrition.NewPostgresCache(pg.Pool())
		if err := pgCache.SeedNutrients(context.Background(), nutrition.SnapshotNutrients()); err != nil {
			// Reference data only: the runtime reads units from the embedded
			// snapshot, so this failing costs SQL-side legibility and nothing else.
			slog.Warn("nutrition: could not seed the nutrients table", "err", err)
		}
		nutritionCache = pgCache
	} else {
		store = recipe.NewMemoryStore()
		slog.Info("store selected", "kind", "memory", "reason", "DATABASE_URL unset")
	}

	secret := os.Getenv("RECIPE_SERVICE_SECRET")
	if secret == "" {
		return errors.New("RECIPE_SERVICE_SECRET is required")
	}

	// One key gates all three LLM paths: extraction (parse a page the JSON-LD
	// reader could not), tagging (BL-0044 — equipment, methods and prep-rule
	// matches for a recipe the keyword scan could not classify), and
	// recommendation candidates (BL-0034 — invent ideas when the corpus is
	// thin). Without it the service still imports, still tags deterministically,
	// still derives prep from the rule table, and still recommends from the
	// corpus; it only loses the gap-fillers.
	var extractor recipe.Extractor
	var importOpts []recipe.ImporterOption
	var routerOpts []recipe.RouterOption
	if apiKey := os.Getenv("ANTHROPIC_API_KEY"); apiKey != "" {
		extractor = recipe.NewClaudeExtractor(apiKey)
		importOpts = append(importOpts, recipe.WithTagger(recipe.NewClaudeTagger(apiKey)))
		routerOpts = append(routerOpts, recipe.WithGenerator(recipe.NewClaudeGenerator(apiKey)))
		slog.Info("LLM paths enabled", "paths", "extraction,tagging,recommendation-candidates")
	} else {
		slog.Info("LLM paths disabled", "reason", "ANTHROPIC_API_KEY unset")
	}
	importer := recipe.NewImporter(recipe.NewHTTPFetcher(), extractor, importOpts...)

	// Nutrition always runs. Without an FDC key it serves the checked-in
	// snapshot alone, which covers common ingredients and reports honestly on
	// everything else — a missing key costs coverage, never correctness.
	fdcKey := os.Getenv("FDC_API_KEY")
	if fdcKey == "" {
		slog.Info("nutrition: live FDC lookups disabled", "reason", "FDC_API_KEY unset")
	} else {
		slog.Info("nutrition: live FDC lookups enabled")
	}
	estimator := nutrition.NewEstimator(
		recipe.DefaultNormalizer(),
		nutrition.NewProvider(nutritionCache, fdcKey),
		nutrition.SnapshotNutrients(),
	)
	routerOpts = append(routerOpts, recipe.WithNutrition(estimator))
	handler := recipe.NewRouterWithImporter(store, secret, importer, routerOpts...)

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
