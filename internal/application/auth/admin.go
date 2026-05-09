// SPDX-License-Identifier: AGPL-3.0-or-later

package auth

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// BackupInfo describes a single backup file on disk.
type BackupInfo struct {
	Filename  string    `json:"filename"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListBackupsOutput carries the list of discovered backup files.
type ListBackupsOutput struct {
	Backups []BackupInfo
}

// ListBackups reads the backup directory and returns metadata for each .dump
// file found. No database access is required.
type ListBackups struct {
	BackupDir string // defaults to "/backups" if empty
}

// Execute scans the backup directory.
func (uc *ListBackups) Execute() (ListBackupsOutput, error) {
	dir := uc.BackupDir
	if dir == "" {
		dir = "/backups"
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return ListBackupsOutput{Backups: []BackupInfo{}}, nil
		}
		return ListBackupsOutput{}, fmt.Errorf("read backup dir: %w", err)
	}

	backups := make([]BackupInfo, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".dump") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue // skip unreadable files
		}
		backups = append(backups, BackupInfo{
			Filename:  filepath.Base(info.Name()),
			Size:      info.Size(),
			CreatedAt: info.ModTime().UTC(),
		})
	}

	return ListBackupsOutput{Backups: backups}, nil
}
