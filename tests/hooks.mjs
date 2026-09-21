// Lets tests import the app's bundler-style extensionless TypeScript modules
// (e.g. '../convex/lib/sizeParsing') under plain Node type stripping.
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  if (isRelative && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context)
    } catch {
      // fall through to the default resolution
    }
  }
  return nextResolve(specifier, context)
}
