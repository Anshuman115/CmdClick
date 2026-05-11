module.exports = {
    name: "RendererMixin",
    actions: {
        convertMarkdown: {
            async handler(ctx) {
                return { html: '' }
            }
        },
        stripHtml: {
            handler(ctx) {
                return { text: '' }
            }
        }
    }
}
