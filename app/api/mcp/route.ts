import { createMcpHandler } from 'agents/mcp/server';
import { server } from '@/lib/mcp';
import { body, event, failure } from '@/lib/cafe';
export async function POST(r: Request) {
  try {
    const p = await body(r);
    if (p?.method === 'initialize') await event(r, 'mcp_initialize');
    if (p?.method === 'tools/list') await event(r, 'mcp_tools_list');
    const copy = new Request(r.url, {
      method: 'POST',
      headers: r.headers,
      body: JSON.stringify(p),
    });
    return await createMcpHandler(() => server(r), {
      route: '/api/mcp',
      allowedOriginHostnames: [
        new URL(r.url).hostname,
        'localhost',
        '127.0.0.1',
      ],
    }).fetch(copy);
  } catch (e) {
    return failure(e);
  }
}
export async function GET(r: Request) {
  return createMcpHandler(() => server(r), { route: '/api/mcp' }).fetch(r);
}
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type,Accept,MCP-Protocol-Version,MCP-Session-Id',
    },
  });
}
