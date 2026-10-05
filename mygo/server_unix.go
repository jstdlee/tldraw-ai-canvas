//go:build unix

package main

import (
	"os/exec"
	"syscall"
	"time"
)

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func stopProcess(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	time.Sleep(200 * time.Millisecond)
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}
