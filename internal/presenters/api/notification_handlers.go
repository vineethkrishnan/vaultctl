// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/notifications"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// NotificationHandlers serves the in-app activity feed.
type NotificationHandlers struct {
	Service *notifications.Service
}

// NotificationDTO is one feed item.
type NotificationDTO struct {
	ID        string `json:"id"`
	Action    string `json:"action"`
	Title     string `json:"title"`
	Category  string `json:"category"`
	CreatedAt string `json:"createdAt"`
	Read      bool   `json:"read"`
}

// NotificationsResponse is the feed plus the unread count.
type NotificationsResponse struct {
	Notifications []NotificationDTO `json:"notifications"`
	UnreadCount   int               `json:"unreadCount"`
}

// HandleList returns the caller's notification feed.
// @Summary List notifications
// @Description Returns the caller's recent activity feed (derived from the audit log) and the unread count.
// @Tags System
// @Produce json
// @Security BearerAuth
// @Success 200 {object} NotificationsResponse
// @Router /notifications [get]
func (h *NotificationHandlers) HandleList(w http.ResponseWriter, r *http.Request) {
	userID := string(middleware.CallerID(r.Context()))
	items, unread, err := h.Service.List(r.Context(), userID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	dtos := make([]NotificationDTO, 0, len(items))
	for _, n := range items {
		dtos = append(dtos, NotificationDTO{
			ID:        n.ID,
			Action:    n.Action,
			Title:     n.Title,
			Category:  n.Category,
			CreatedAt: n.CreatedAt.UTC().Format(time.RFC3339),
			Read:      n.Read,
		})
	}
	writeJSON(w, http.StatusOK, NotificationsResponse{Notifications: dtos, UnreadCount: unread})
}

// HandleMarkRead marks the whole feed as read.
// @Summary Mark notifications read
// @Tags System
// @Produce json
// @Security BearerAuth
// @Success 200 {object} OKResponse
// @Router /notifications/read [post]
func (h *NotificationHandlers) HandleMarkRead(w http.ResponseWriter, r *http.Request) {
	userID := string(middleware.CallerID(r.Context()))
	if err := h.Service.MarkAllRead(r.Context(), userID); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, OKResponse{OK: true})
}

// HandleClear hides all current events from the feed.
// @Summary Clear notifications
// @Tags System
// @Produce json
// @Security BearerAuth
// @Success 200 {object} OKResponse
// @Router /notifications/clear [post]
func (h *NotificationHandlers) HandleClear(w http.ResponseWriter, r *http.Request) {
	userID := string(middleware.CallerID(r.Context()))
	if err := h.Service.ClearAll(r.Context(), userID); err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, OKResponse{OK: true})
}
