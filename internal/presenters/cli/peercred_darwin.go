// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import "golang.org/x/sys/unix"

func peerUIDOf(fd int) (uint32, error) {
	cred, err := unix.GetsockoptXucred(fd, unix.SOL_LOCAL, unix.LOCAL_PEERCRED)
	if err != nil {
		return 0, err
	}
	return cred.Uid, nil
}
