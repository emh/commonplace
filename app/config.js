const COMMONPLACE_HOST = globalThis.location?.hostname || "";
const COMMONPLACE_IS_LOCAL = COMMONPLACE_HOST === "localhost" ||
  COMMONPLACE_HOST === "127.0.0.1" ||
  COMMONPLACE_HOST.endsWith(".local") ||
  /^10\./.test(COMMONPLACE_HOST) ||
  /^192\.168\./.test(COMMONPLACE_HOST) ||
  /^169\.254\./.test(COMMONPLACE_HOST) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(COMMONPLACE_HOST);

globalThis.COMMONPLACE_CONFIG = globalThis.COMMONPLACE_CONFIG || {
  syncBaseUrl: COMMONPLACE_IS_LOCAL ? "" : "https://commonplace-sync.emh.workers.dev",
  studyBaseUrl: COMMONPLACE_IS_LOCAL ? "" : "https://commonplace-study.emh.workers.dev/",
  articleBaseUrl: COMMONPLACE_IS_LOCAL ? "" : "https://commonplace-article.emh.workers.dev"
};
