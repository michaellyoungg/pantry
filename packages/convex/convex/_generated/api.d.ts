/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as auth from "../auth.js";
import type * as basket from "../basket.js";
import type * as equipment from "../equipment.js";
import type * as groceryList from "../groceryList.js";
import type * as http from "../http.js";
import type * as lib_affinity from "../lib/affinity.js";
import type * as lib_otel from "../lib/otel.js";
import type * as nutrition from "../nutrition.js";
import type * as nutritionLog from "../nutritionLog.js";
import type * as nutritionTargets from "../nutritionTargets.js";
import type * as pantry from "../pantry.js";
import type * as preferences from "../preferences.js";
import type * as prepTasks from "../prepTasks.js";
import type * as presence from "../presence.js";
import type * as pricing from "../pricing.js";
import type * as recipes from "../recipes.js";
import type * as recommendationEvents from "../recommendationEvents.js";
import type * as recommendations from "../recommendations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  auth: typeof auth;
  basket: typeof basket;
  equipment: typeof equipment;
  groceryList: typeof groceryList;
  http: typeof http;
  "lib/affinity": typeof lib_affinity;
  "lib/otel": typeof lib_otel;
  nutrition: typeof nutrition;
  nutritionLog: typeof nutritionLog;
  nutritionTargets: typeof nutritionTargets;
  pantry: typeof pantry;
  preferences: typeof preferences;
  prepTasks: typeof prepTasks;
  presence: typeof presence;
  pricing: typeof pricing;
  recipes: typeof recipes;
  recommendationEvents: typeof recommendationEvents;
  recommendations: typeof recommendations;
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
