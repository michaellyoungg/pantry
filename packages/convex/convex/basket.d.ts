export declare const list: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"basket">;
    _creationTime: number;
    userId: string;
    recipeId: string;
    title: string;
}[]>>;
export declare const add: import("convex/server").RegisteredMutation<"public", {
    recipeId: string;
    title: string;
}, Promise<import("convex/values").GenericId<"basket">>>;
export declare const remove: import("convex/server").RegisteredMutation<"public", {
    recipeId: string;
}, Promise<void>>;
