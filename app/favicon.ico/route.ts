import { ORIGIN } from '@/lib/menu';
export function GET() {
  return Response.redirect(ORIGIN + '/favicon.svg', 308);
}
