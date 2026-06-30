declare const _default: import("convex/server").SchemaDefinition<{
    preferences: import("convex/server").TableDefinition<import("convex/values").VObject<{
        data?: any;
        userId: string;
    }, {
        userId: import("convex/values").VString<string, "required">;
        data: import("convex/values").VAny<any, "optional", string>;
    }, "required", "userId" | "data" | `data.${string}`>, {
        by_user: ["userId", "_creationTime"];
    }, {}, {}>;
    basket: import("convex/server").TableDefinition<import("convex/values").VObject<{
        userId: string;
        recipeId: string;
        title: string;
    }, {
        userId: import("convex/values").VString<string, "required">;
        recipeId: import("convex/values").VString<string, "required">;
        title: import("convex/values").VString<string, "required">;
    }, "required", "userId" | "recipeId" | "title">, {
        by_user: ["userId", "_creationTime"];
        by_user_recipe: ["userId", "recipeId", "_creationTime"];
    }, {}, {}>;
    groceryList: import("convex/server").TableDefinition<import("convex/values").VObject<{
        userId: string;
        item: string;
        unit: string;
        quantity: number;
        checked: boolean;
    }, {
        userId: import("convex/values").VString<string, "required">;
        item: import("convex/values").VString<string, "required">;
        unit: import("convex/values").VString<string, "required">;
        quantity: import("convex/values").VFloat64<number, "required">;
        checked: import("convex/values").VBoolean<boolean, "required">;
    }, "required", "userId" | "item" | "unit" | "quantity" | "checked">, {
        by_user: ["userId", "_creationTime"];
    }, {}, {}>;
}, true>;
export default _default;
