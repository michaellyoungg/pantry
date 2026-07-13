// The self-hosted backend injects CONVEX_SITE_URL. Convex Auth validates its
// own JWTs against this issuer.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
