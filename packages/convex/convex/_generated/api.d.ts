/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as basket from "../basket.js";
import type * as groceryList from "../groceryList.js";
import type * as http from "../http.js";
import type * as lib_otel from "../lib/otel.js";
import type * as nutritionLog from "../nutritionLog.js";
import type * as pantry from "../pantry.js";
import type * as pricing from "../pricing.js";
import type * as recipes from "../recipes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  basket: typeof basket;
  groceryList: typeof groceryList;
  http: typeof http;
  "lib/otel": typeof lib_otel;
  nutritionLog: typeof nutritionLog;
  pantry: typeof pantry;
  pricing: typeof pricing;
  recipes: typeof recipes;
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

export declare const components: {};
