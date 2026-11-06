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
  // Which branch each environment deploys from. dev follows main, so every
  // merge lands there; production follows `release`, which only moves when
  // someone pushes it, which is what makes promotion deliberate.
  //
  // checkSuites is false on purpose: a merged PR has already run the full
  // suite, so waiting for the merge commit's checks re-proves a known verdict
  // and delays the deploy. CI does not run on main at all any more.
  const repo = "michaellyoungg/pantry";
  // One region for everything, in both environments. Railway Metal regions
  // carry a datacenter code (eqdc4a is Equinix DC4); bare cloud names like
  // us-west2 are the legacy fleet. Duplicating production into dev put dev's
  // VOLUMES in us-west2 while its services ran here, so dev was split across
  // two regions and two fleets, which is the cross-region latency the Metal
  // docs warn about. Pinning it here is what stops that recurring.
  const region = "us-east4-eqdc4a";
  const branch = c.isEnvironment("production") ? "release" : "main";
  const deployTrigger = { branch, checkSuites: false };
  const Postgres = postgres("Postgres", { region });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
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
  const sleepWhenIdle = !c.isEnvironment("production");
  const web = service("web", {
    // No rootDirectory: this image's build context IS the repo root, because
    // @pantry/web resolves four workspace packages through their built dist/.
    source: github(repo, deployTrigger),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/web/Dockerfile" },
    replicas: { [region]: 1 },
    deploy: { sleepApplication: sleepWhenIdle },
  });
  const convexDashboard = service("convex-dashboard", {
    source: image(
      "ghcr.io/convex/convex-dashboard@sha256:caf95d3f2241cddc103a84b728294fa0777c6acc291a2c4612c1d06faaa1c43a",
    ),
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { [region]: 1 },
    deploy: { sleepApplication: sleepWhenIdle },
  });
  const seed = service("seed", {
    // The import omitted this, so an apply would have nulled seed's source and
    // left it unbuildable. It shares recipe-service's image and overrides the
    // start command, because Railway cannot select a Docker build target.
    source: github(repo, { ...deployTrigger, rootDirectory: "apps/recipe-service" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "/seed",
    replicas: { [region]: 1 },
    deploy: { cronSchedule: "0 7 * * *", restartPolicyType: "NEVER" },
  });
  const recipeService = service("recipe-service", {
    source: github(repo, { ...deployTrigger, rootDirectory: "apps/recipe-service" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { [region]: 1 },
    deploy: { sleepApplication: sleepWhenIdle },
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
