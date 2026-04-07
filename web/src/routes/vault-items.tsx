import { ItemList } from "@/components/vault/ItemList";

export function VaultItemsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">All Items</h1>
      <ItemList />
    </div>
  );
}
