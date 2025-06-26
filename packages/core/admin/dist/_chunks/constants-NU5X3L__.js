"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const ROUTES_EE = [
  ...window.strapi.features.isEnabled(window.strapi.features.AUDIT_LOGS) ? [
    {
      async Component() {
        const { ProtectedListPage } = await Promise.resolve().then(() => require("./ListPage-G9_lRT3d.js"));
        return ProtectedListPage;
      },
      to: "/settings/audit-logs",
      exact: true
    }
  ] : [],
  ...window.strapi.features.isEnabled(window.strapi.features.REVIEW_WORKFLOWS) ? [
    {
      async Component() {
        const { ProtectedReviewWorkflowsPage } = await Promise.resolve().then(() => require("./ListPage-cSN6fBYY.js"));
        return ProtectedReviewWorkflowsPage;
      },
      to: "/settings/review-workflows",
      exact: true
    },
    {
      async Component() {
        const { ReviewWorkflowsCreatePage } = await Promise.resolve().then(() => require("./CreatePage-Ky9ikoRF.js"));
        return ReviewWorkflowsCreatePage;
      },
      to: "/settings/review-workflows/create",
      exact: true
    },
    {
      async Component() {
        const { ReviewWorkflowsEditPage } = await Promise.resolve().then(() => require("./EditPage-kHBTWu14.js"));
        return ReviewWorkflowsEditPage;
      },
      to: "/settings/review-workflows/:workflowId",
      exact: true
    }
  ] : [],
  ...window.strapi.features.isEnabled(window.strapi.features.SSO) ? [
    {
      async Component() {
        const { ProtectedSSO } = await Promise.resolve().then(() => require("./SingleSignOnPage-BCk4Q3M4.js"));
        return ProtectedSSO;
      },
      to: "/settings/single-sign-on",
      exact: true
    }
  ] : []
];
exports.ROUTES_EE = ROUTES_EE;
//# sourceMappingURL=constants-NU5X3L__.js.map
