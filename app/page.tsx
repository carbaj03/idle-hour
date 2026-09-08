import Cafe, { type Snapshot } from '@/components/cafe';
import { table } from '@/lib/cafe';
import { ORIGIN } from '@/lib/menu';
export const dynamic = 'force-dynamic';
export default async function Home() {
  let initialData: Snapshot | null = null;
  try {
    initialData = await table(new Request(ORIGIN), 'stories');
  } catch {
    /* The client retry shows an unavailable state if the read still fails. */
  }
  return <Cafe initialData={initialData} />;
}
