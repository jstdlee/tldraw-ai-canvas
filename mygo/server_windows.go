//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}

func stopProcess(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
