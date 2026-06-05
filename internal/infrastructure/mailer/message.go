// SPDX-License-Identifier: AGPL-3.0-or-later

package mailer

import (
	"bytes"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/textproto"
	"time"
)

// buildMIME assembles an RFC 5322 message. With both bodies it emits
// multipart/alternative (text first, then HTML, per RFC 2046 preference order);
// otherwise a single part. Bodies are quoted-printable so German umlauts and
// long lines survive 7-bit transports.
func buildMIME(fromHeader, to, subject, text, html string, date time.Time) ([]byte, error) {
	var msg bytes.Buffer
	fmt.Fprintf(&msg, "From: %s\r\n", fromHeader)
	fmt.Fprintf(&msg, "To: %s\r\n", to)
	fmt.Fprintf(&msg, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", subject))
	fmt.Fprintf(&msg, "Date: %s\r\n", date.Format(time.RFC1123Z))
	msg.WriteString("MIME-Version: 1.0\r\n")

	switch {
	case text != "" && html != "":
		mw := multipart.NewWriter(&msg)
		fmt.Fprintf(&msg, "Content-Type: multipart/alternative; boundary=%s\r\n\r\n", mw.Boundary())
		if err := writeQPPart(mw, "text/plain; charset=utf-8", text); err != nil {
			return nil, err
		}
		if err := writeQPPart(mw, "text/html; charset=utf-8", html); err != nil {
			return nil, err
		}
		if err := mw.Close(); err != nil {
			return nil, err
		}
	case html != "":
		if err := writeSingleQP(&msg, "text/html; charset=utf-8", html); err != nil {
			return nil, err
		}
	default:
		if err := writeSingleQP(&msg, "text/plain; charset=utf-8", text); err != nil {
			return nil, err
		}
	}
	return msg.Bytes(), nil
}

func writeQPPart(mw *multipart.Writer, contentType, body string) error {
	header := textproto.MIMEHeader{}
	header.Set("Content-Type", contentType)
	header.Set("Content-Transfer-Encoding", "quoted-printable")
	part, err := mw.CreatePart(header)
	if err != nil {
		return err
	}
	return writeQP(part, body)
}

func writeSingleQP(buf *bytes.Buffer, contentType, body string) error {
	fmt.Fprintf(buf, "Content-Type: %s\r\n", contentType)
	buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
	return writeQP(buf, body)
}

func writeQP(w interface{ Write([]byte) (int, error) }, body string) error {
	qp := quotedprintable.NewWriter(w)
	if _, err := qp.Write([]byte(body)); err != nil {
		return err
	}
	return qp.Close()
}
