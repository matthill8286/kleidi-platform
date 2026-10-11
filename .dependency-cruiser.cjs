/** Architecture fitness rules. `pnpm boundaries` fails the build when the module design erodes. */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Modules and packages must not depend on each other in a loop.",
      from: {},
      to: { circular: true },
    },
    {
      name: "module-public-api-only",
      severity: "error",
      comment: "A module may use another module only through that module's index.ts.",
      from: { path: "^packages/modules/src/([^/]+)/" },
      to: {
        path: "^packages/modules/src/[^/]+/",
        pathNot: ["^packages/modules/src/$1/", "^packages/modules/src/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "module-owns-its-tables",
      severity: "error",
      comment:
        "A module may import only its own schema file; other modules' data comes through their public API.",
      from: { path: "^packages/modules/src/([^/]+)/" },
      to: {
        path: "^packages/db/src/schema/",
        pathNot: "^packages/db/src/schema/($1|columns)\\.ts$",
      },
    },
    {
      name: "pure-domain",
      severity: "error",
      comment:
        "domain.ts files hold business rules only: no database, HTTP, auth or email libraries.",
      from: { path: "^packages/modules/src/[^/]+/domain\\.ts$" },
      to: {
        path: "^packages/db/|node_modules/(drizzle-orm|better-auth|nodemailer|fastify|postgres|pg-boss)/",
      },
    },
    {
      name: "kernel-depends-on-nothing",
      severity: "error",
      comment: "The shared kernel must not import any other Kleidi package.",
      from: { path: "^packages/kernel/" },
      to: { path: "^(packages/(?!kernel/)|apps/)" },
    },
    {
      name: "packages-never-import-apps",
      severity: "error",
      comment: "Apps are wiring only; nothing may depend on them.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "web-stays-out-of-the-server",
      severity: "error",
      comment: "The browser app talks to the API over HTTP and never imports server packages.",
      from: { path: "^apps/web/" },
      to: { path: "^(packages/(db|modules|kernel)|apps/(api|worker))/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|migrations|node_modules)/|routeTree\\.gen\\.ts$" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
