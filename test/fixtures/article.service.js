const RendererMixin = require("./renderer.mixin.js")

module.exports = {
    name: "articles",
    version: 1,
    mixins: [RendererMixin],
    actions: {
        publish: {
            async handler(ctx) {
                const author = await ctx.call("v1.authors.getProfile", { id: ctx.params.authorId })
                const media = await ctx.call("v1.media.transcode", { url: ctx.params.mediaUrl })
                await ctx.emit("article.published", { articleId: "new-id" })
                return { id: "new-id" }
            }
        },
        archive: {
            async handler(ctx) {
                await this.broker.call("v1.media.upload", { articleId: ctx.params.id })
                await ctx.emit("article.archived", { articleId: ctx.params.id })
            }
        },
        getBySlug: {
            async handler(ctx) {
                const result = await ctx
                    .call("v1.media.transcode", { check: true })
                return result
            }
        }
    }
}
