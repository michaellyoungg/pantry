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

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "us-east4-eqdc4a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres", tcpProxies: { "5432": {} } };
  // The postgres() helper defaults to postgres:18 and DatabaseConfig has no
  // image field, so without this an apply would attempt a MAJOR version
  // upgrade of the live database. `railway config plan` caught exactly that.
  Postgres.source = image("postgres:17");
  const postgresVolumeMshb = volume("postgres-volume-mshb", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 5000,
  });
  const convexBackendVolume = volume("convex-backend-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "us-east4-eqdc4a",
    sizeMB: 5000,
  });
  const convexBackend = service("convex-backend", {
    source: image(
      "ghcr.io/convex/convex-backend@sha256:e9c084e8bd6c1f249012c672193f0988c748824f55a24cdad45f6185a8462f9a",
    ),
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { restartPolicyMaxRetries: 50 },
    volumeMounts: { "/convex/data": convexBackendVolume },
  });
  const web = service("web", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/web/Dockerfile" },
    replicas: { "us-east4-eqdc4a": 1 },
  });
  const convexDashboard = service("convex-dashboard", {
    source: image(
      "ghcr.io/convex/convex-dashboard@sha256:caf95d3f2241cddc103a84b728294fa0777c6acc291a2c4612c1d06faaa1c43a",
    ),
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "us-east4-eqdc4a": 1 },
  });
  const seed = service("seed", {
    // The import omitted this, so an apply would have nulled seed's source and
    // left it unbuildable. It shares recipe-service's image and overrides the
    // start command, because Railway cannot select a Docker build target.
    source: github("michaellyoungg/pantry", { rootDirectory: "apps/recipe-service" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "/seed",
    replicas: { "us-east4-eqdc4a": 1 },
    deploy: { cronSchedule: "0 7 * * *", restartPolicyType: "NEVER" },
  });
  const recipeService = service("recipe-service", {
    source: github("michaellyoungg/pantry", { rootDirectory: "apps/recipe-service" }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    replicas: { "us-east4-eqdc4a": 1 },
  });
  const ConvexPostgresOfficial = group("Convex & Postgres - Official", [
    Postgres,
    convexBackend,
    convexDashboard,
  ]);

  return project("pantry", {
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
