package vault

import (
	"context"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// ImportedItem is a single item in the import payload. The client performs
// format conversion + encryption; the server just persists the opaque blobs.
type ImportedItem struct {
	ItemType      domainvault.ItemType
	EncryptedData crypto.EncryptedBlob
	EncryptedName crypto.EncryptedBlob
	FolderID      *domainvault.FolderID
}

// ImportItemsInput carries the batch of items to import.
type ImportItemsInput struct {
	Caller  user.ID
	VaultID domainvault.ID
	Items   []ImportedItem
}

// ImportItemsOutput reports how many items were imported.
type ImportItemsOutput struct {
	ImportedCount int
}

// ImportItems batch-creates vault items from an import payload.
type ImportItems struct {
	Vaults ports.VaultRepository
	Items  ports.ItemRepository
	Clock  ports.Clock
	IDs    ports.IDGenerator
}

// Execute validates membership and batch-inserts all items.
func (uc *ImportItems) Execute(ctx context.Context, in ImportItemsInput) (ImportItemsOutput, error) {
	if _, err := ensureActiveMember(ctx, uc.Vaults, in.Caller, in.VaultID); err != nil {
		return ImportItemsOutput{}, err
	}

	if len(in.Items) == 0 {
		return ImportItemsOutput{}, nil
	}

	now := uc.Clock.Now()
	domainItems := make([]domainvault.Item, 0, len(in.Items))
	for i, imp := range in.Items {
		item := domainvault.Item{
			ID:            domainvault.ItemID(uc.IDs.NewID()),
			VaultID:       in.VaultID,
			FolderID:      imp.FolderID,
			ItemType:      imp.ItemType,
			EncryptedData: imp.EncryptedData,
			EncryptedName: imp.EncryptedName,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if err := item.Validate(); err != nil {
			return ImportItemsOutput{}, fmt.Errorf("item[%d]: %w", i, err)
		}
		domainItems = append(domainItems, item)
	}

	if err := uc.Items.CreateBatch(ctx, domainItems); err != nil {
		return ImportItemsOutput{}, fmt.Errorf("batch create: %w", err)
	}

	return ImportItemsOutput{ImportedCount: len(domainItems)}, nil
}
