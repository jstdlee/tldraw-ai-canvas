package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// parseListenURL reads the line the canvas server prints when it is listening.
func parseListenURL(line string) (string, bool) {
	const marker = "AI canvas server on "
	i := strings.Index(line, marker)
	if i < 0 {
		return "", false
	}
	fields := strings.Fields(line[i+len(marker):])
	if len(fields) == 0 || !strings.HasPrefix(fields[0], "http://127.0.0.1:") {
		return "", false
	}
	return fields[0], true
}

// isAppURL reports whether raw is the local canvas origin or a page under it.
func isAppURL(raw, origin string) bool {
	return raw == origin || strings.HasPrefix(raw, origin+"/")
}

// startCanvasServer runs the bundled Node server and waits until it listens.
// The caller stops cmd when the app quits.
func startCanvasServer(nodeBin, script, staticDir, dataDir string) (*exec.Cmd, string, error) {
	if _, err := os.Stat(nodeBin); err != nil {
		return nil, "", fmt.Errorf("node runtime is missing (%s). Run npm run build:mygo", nodeBin)
	}
	if _, err := os.Stat(script); err != nil {
		return nil, "", fmt.Errorf("desktop launcher is missing (%s). Run npm run build:mygo", script)
	}
	bundle := filepath.Join(filepath.Dir(script), "server.cjs")
	if _, err := os.Stat(bundle); err != nil {
		return nil, "", fmt.Errorf("server bundle is missing (%s). Run npm run build:mygo", bundle)
	}
	cmd := exec.Command(nodeBin, script)
	cmd.Dir = dataDir
	cmd.Env = append(os.Environ(),
		"AI_CANVAS_EMBEDDED=1",
		"NODE_ENV=production",
		"STATIC_DIR="+staticDir,
		"DATA_DIR="+dataDir,
	)
	configureProcess(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, "", err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, "", err
	}

	found := make(chan string, 1)
	go func() {
		scan := bufio.NewScanner(stdout)
		for scan.Scan() {
			line := scan.Text()
			fmt.Println(line)
			if url, ok := parseListenURL(line); ok {
				found <- url
				_, _ = io.Copy(os.Stdout, stdout)
				return
			}
		}
		close(found)
	}()

	timer := time.NewTimer(30 * time.Second)
	defer timer.Stop()
	select {
	case url, ok := <-found:
		if !ok || url == "" {
			stopProcess(cmd)
			_ = cmd.Wait()
			return nil, "", fmt.Errorf("the canvas server stopped before it listened")
		}
		return cmd, url, nil
	case <-timer.C:
		stopProcess(cmd)
		_ = cmd.Wait()
		return nil, "", fmt.Errorf("the canvas server did not listen within 30s")
	}
}
