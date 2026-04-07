package middleware

import (
	"encoding/json"
	"net/http"
)

// errorResponse is the standard JSON error shape returned by middleware.
type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeErr(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	var resp errorResponse
	resp.Error.Code = code
	resp.Error.Message = message
	_ = json.NewEncoder(w).Encode(resp)
}
