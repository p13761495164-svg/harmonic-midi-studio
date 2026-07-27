import type { NextConfig } from "next";

const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const configuredBasePath = (process.env.HARMONIC_BASE_PATH ?? "")
  .trim()
  .replace(/\/+$/, "");
const basePath =
  configuredBasePath ||
  (isGithubActions && repositoryName ? `/${repositoryName}` : "");

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath ? `${basePath}/` : "",
};

export default nextConfig;
