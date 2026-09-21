/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alternatives from "../alternatives.js";
import type * as auth from "../auth.js";
import type * as caseActions from "../caseActions.js";
import type * as cases from "../cases.js";
import type * as fit from "../fit.js";
import type * as http from "../http.js";
import type * as lib_alternativeMatching from "../lib/alternativeMatching.js";
import type * as lib_caseComparison from "../lib/caseComparison.js";
import type * as lib_caseRules from "../lib/caseRules.js";
import type * as lib_fitRecommendation from "../lib/fitRecommendation.js";
import type * as lib_imageChecks from "../lib/imageChecks.js";
import type * as lib_sizeGuideLinks from "../lib/sizeGuideLinks.js";
import type * as lib_sizeParsing from "../lib/sizeParsing.js";
import type * as lib_tryOnPrompt from "../lib/tryOnPrompt.js";
import type * as products from "../products.js";
import type * as profiles from "../profiles.js";
import type * as tryOn from "../tryOn.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alternatives: typeof alternatives;
  auth: typeof auth;
  caseActions: typeof caseActions;
  cases: typeof cases;
  fit: typeof fit;
  http: typeof http;
  "lib/alternativeMatching": typeof lib_alternativeMatching;
  "lib/caseComparison": typeof lib_caseComparison;
  "lib/caseRules": typeof lib_caseRules;
  "lib/fitRecommendation": typeof lib_fitRecommendation;
  "lib/imageChecks": typeof lib_imageChecks;
  "lib/sizeGuideLinks": typeof lib_sizeGuideLinks;
  "lib/sizeParsing": typeof lib_sizeParsing;
  "lib/tryOnPrompt": typeof lib_tryOnPrompt;
  products: typeof products;
  profiles: typeof profiles;
  tryOn: typeof tryOn;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
