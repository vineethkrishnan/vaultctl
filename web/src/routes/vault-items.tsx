import { ItemList } from "@/components/vault/ItemList";
import { SharingPanel } from "@/components/vault/SharingPanel";

export function VaultItemsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="mb-4 text-xl font-bold">All Items</h1>
        <ItemList />
      </div>
      <section className="rounded-lg border border-border p-4">
        <SharingPanel />
      </section>
    </div>
  );
}
