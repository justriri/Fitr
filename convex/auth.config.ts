export default {
  providers: [
    {
      // Password provider — email + password sign in/up.
      // No external OAuth needed for MVP.
      // CONVEX_SITE_URL is set automatically by Convex when you run `npx convex dev`.
      domain: process.env['CONVEX_SITE_URL'],
      applicationID: 'convex',
    },
  ],
}
