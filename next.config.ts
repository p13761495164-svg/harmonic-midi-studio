import type { NextConfig } from "next";

const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: isGithubActions && repositoryName ? `/${repositoryName}` : "",
  assetPrefix: isGithubActions && repositoryName ? `/${repositoryName}/` : "",
};

export default nextConfig;
