export interface Env {
  DB: D1Database;
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response('pokemon-tcg-history-api — endpoints coming in Task 2', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  },
};
