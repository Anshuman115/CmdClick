const RendererMixin = require("./renderer.mixin.js")

module.exports = {
    name: "media",
    version: 1,
    mixins: [RendererMixin],
    actions: {
        transcode: {
            async handler(ctx) {
                const author = await ctx.call("v1.authors.getProfile", { id: ctx.params.authorId })
                await ctx.emit("media.uploaded", { mediaId: "new-id" })
                return { success: true }
            }
        },
        upload: {
            handler(ctx) {
                const size = this.calculateSize(ctx.params.bytes)
                return { size }
            }
        }
    },
    methods: {
        calculateSize(bytes) {
            return bytes / 1024
        }
    }
}
