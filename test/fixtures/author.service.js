module.exports = {
    name: "authors",
    version: 1,
    actions: {
        getProfile: {
            async handler(ctx) {
                return { id: ctx.params.id, handle: "test-author" }
            }
        },
        register: {
            async handler(ctx) {
                await ctx.emit("author.registered", { authorId: "new-id" })
                return { id: "new-id" }
            }
        }
    },
    methods: {
        validateHandle(handle) {
            return handle.length >= 3
        }
    }
}
