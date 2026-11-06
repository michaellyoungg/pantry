import {
  defineRailway,
  github,
  group,
  image,
  postgres,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway((c) => {
  // A git source WITH a branch is a deploy trigger in Railway. The deployment
  // model is:
  //
  //   dev        tracks main, so every merge deploys.
  //   production has no trigger. It is deployed by the "Promote to production"
  //              workflow, which pins an exact commit rather than following a
  //              branch, so what shipped is a sha and not "whatever main was".
  //
  // Promotion used to be a push to a `release` branch. That moved the services
  // and the topology but NOT the Convex schema, which needed a second action
  // nobody would remember. One workflow now does all three in order.
  //
  // READ THIS BEFORE CHANGING deployTrigger. The github() helper is
  // `{ type, repo, branch: options.branch ?? "main", ...options }`, so there are
  // THREE states and only two of them are what they look like:
  //
  //   { branch: "main" }      declares a trigger on main.
  //   {}                      ALSO declares a trigger on main, via that ??.
  //   { branch: undefined }   emits no branch key, so IaC does not manage the
  //                           trigger and leaves whatever is live alone.
  //
  // `{}` is therefore the opposite of "no trigger", and the plan's human diff
  // renders it as `source.branch (... -> null)` either way; only
  // `railway config plan --json` distinguishes them. An earlier revision of
  // this file used `{}` for production and would have put production back on
  // push-to-deploy the first time anything applied it.
  //
  // Note what the third state does NOT do: it cannot REMOVE a live trigger.
  // Production's triggers were deleted out of band with deploymentTriggerDelete;
  // this declaration is what stops an apply recreating them.
  //
  // checkSuites is false on dev: a merged PR has already run the full suite, so
  // waiting on the merge commit re-proves a known verdict. CI does not run on
  // main at all.
  const repo = "michaellyoungg/pantry";
  // One region for everything, in both environments. Railway Metal regions
  // carry a datacenter code (eqdc4a is Equinix DC4); bare cloud names like
  // us-west2 are the legacy fleet. Duplicating production into dev put dev's
  // VOLUMES in us-west2 while its services ran here, so dev was split across
  // two regions and two fleets, which is the cross-region latency the Metal
  // docs warn about. Pinning it here is what stops that recurring.
  const region = "us-east4-eqdc4a";
  const deployTrigger: { branch?: string; checkSuites?: boolean } =
    c.isEnvironment("production")
      ? { branch: undefined }
      : { branch: "main", checkSuites: false };
  const Postgres = postgres("Postgres", { region });
  Postgres.networking = {
    privateNetworkEndpoint: "postgres",
    tcpProxies: { "5432": {} },
  };
  // The postgres() helper defaults to postgres:18 and DatabaseConfig has no
  // image field, so without this an apply would attempt a MAJOR version
  // upgrade of the live database. `railway config plan` caught exactly that.
  Postgres.source = image("postgres:17");
  const postgresVolumeMshb = volume("postgres-volume-mshb", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region,
    sizeMB: 5000,
  });
  const convexBackendVolume = volume("convex-backend-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region,
    sizeMB: 5000,
  });
  const convexBackend = service("convex-backend", {
    source: image(
      "ghcr.io/convex/convex-backend@sha256:e9c084e8bd6c1f249012c672193f0988c748824f55a24cdad45f6185a8462f9a",
    ),
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { [region]: 1 },
    deploy: { restartPolicyMaxRetries: 50 },
    volumeMounts: { "/convex/data": convexBackendVolume },
  });
  // Serverless sleeps a service after ~10 minutes with no OUTBOUND traffic, and
  // an open database connection counts as outbound.
  //
  // convex-backend is deliberately excluded. It exits rather than retrying when
  // Postgres is unreachable, and a restart budget spent in seconds is how dev
  // lost it for twenty minutes. recipe-service used to share that flaw and no
  // longer does: it retries the startup connection for two minutes with
  // backoff, so waking into a database that is still coming up is survivable.
  //
  // Caveat worth measuring rather than assuming: pgxpool runs a health check on
  // a timer, which is itself outbound traffic, so recipe-service may never
  // actually go idle. Sleeping it costs nothing if so; making it effective
  // means shortening the pool's idle timeouts.
  // Declared only where true: Railway reports an unset sleepApplication as
  // null, so declaring `false` leaves a change that every plan reports and no
  // apply can ever settle.
  const sleepWhenIdle = c.isEnvironment("production")
    ? {}
    : { sleepApplication: true };
  // Railway's edge cache, on in both environments. Production already had it on
  // and this file did not declare it, so the first production apply would have
  // turned it off — graded `safe`, so --confirm-destructive would not have
  // stopped it either.
  //
  // Caching is correct for this app precisely because the image sets the headers
  // for it: `no-cache` on index.html and immutable on /assets/*. htmlCaching
  // defaults to "auto", which follows those, so the shell revalidates on every
  // load and only the hashed bundles are served from the edge. That is also why
  // it is safe on dev: a deploy cannot leave you looking at a stale app, because
  // the document that names the bundles is never cached.
  const cdn = { enabled: true };
  const web = service("web", {
    // No rootDirectory: this image's build context IS the repo root, because
    // @pantry/web resolves four workspace packages through their built dist/.
    source: github(repo, deployTrigger),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "apps/web/Dockerfile",
    },
    replicas: { [region]: 1 },
    cdn,
    deploy: { ...sleepWhenIdle },
  });
  const convexDashboard = service("convex-dashboard", {
    source: image(
      "ghcr.io/convex/convex-dashboard@sha256:caf95d3f2241cddc103a84b728294fa0777c6acc291a2c4612c1d06faaa1c43a",
    ),
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { [region]: 1 },
    deploy: { ...sleepWhenIdle },
  });
  const seed = service("seed", {
    // The import omitted this, so an apply would have nulled seed's source and
    // left it unbuildable. It shares recipe-service's image and overrides the
    // start command, because Railway cannot select a Docker build target.
    source: github(repo, {
      ...deployTrigger,
      rootDirectory: "apps/recipe-service",
    }),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    start: "/seed",
    replicas: { [region]: 1 },
    deploy: { cronSchedule: "0 7 * * *", restartPolicyType: "NEVER" },
  });
  const recipeService = service("recipe-service", {
    source: github(repo, {
      ...deployTrigger,
      rootDirectory: "apps/recipe-service",
    }),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    replicas: { [region]: 1 },
    deploy: { ...sleepWhenIdle },
  });
  const ConvexPostgresOfficial = group("Convex & Postgres - Official", [
    Postgres,
    convexBackend,
    convexDashboard,
  ]);

  return project("pantry", {
    environments: ["production", "dev"],
    variables: { managed: false },
    resources: [
      web,
      seed,
      recipeService,
      postgresVolumeMshb,
      convexBackendVolume,
      ConvexPostgresOfficial,
    ],
  });
});
