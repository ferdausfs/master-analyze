export default {
  async fetch(request, env, ctx) {
    return new Response(
      JSON.stringify({
        status: "ok",
        message: "Hello from Cloudflare Worker 🚀"
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
};
