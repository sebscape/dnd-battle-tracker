export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try { return await next(specifier + ".ts", context); } catch { /* fall through */ }
    }
    throw error;
  }
}
