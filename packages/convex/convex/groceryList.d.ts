export declare const getGroceryList: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"groceryList">;
    _creationTime: number;
    userId: string;
    item: string;
    unit: string;
    quantity: number;
    checked: boolean;
}[]>>;
export declare const replaceGroceryList: import("convex/server").RegisteredMutation<"internal", {
    lines: {
        item: string;
        unit: string;
        quantity: number;
    }[];
}, Promise<void>>;
export declare const toggleItem: import("convex/server").RegisteredMutation<"public", {
    id: import("convex/values").GenericId<"groceryList">;
    checked: boolean;
}, Promise<void>>;
