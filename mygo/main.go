// AI Canvas desktop shell. MyGo opens the system webview. The existing
// Node server, the same bundle Electron runs, serves the page and the API.
package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/egoist/mygo"
)

var (
	mainWindow *mygo.Window
	serverCmd  *exec.Cmd
	origin     string
	dataDir    string
)

func main() {
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	mygo.App.OnSecondInstance(func([]string, string) {
		if mainWindow == nil {
			return
		}
		mainWindow.Restore()
		mainWindow.Focus()
	})
	mygo.App.OnQuit(func() { stopServer() })
	mygo.App.OnWindowAllClosed(func() {
		if runtime.GOOS != "darwin" {
			mygo.App.Quit()
		}
	})
	mygo.App.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows && origin != "" {
			openWindow()
		}
	})
	mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu},
		{Role: mygo.RoleFileMenu},
		{Role: mygo.RoleEditMenu},
		{Role: mygo.RoleViewMenu},
		{Role: mygo.RoleWindowMenu},
		{Label: "Help", Submenu: []*mygo.MenuItem{
			{Label: "Open data folder", Click: func(*mygo.MenuItem, *mygo.Window) {
				if dataDir != "" {
					_ = mygo.Shell.OpenPath(dataDir)
				}
			}},
		}},
	}))
	mygo.App.WhenReady(func() {
		if err := boot(); err != nil {
			log.Println(err)
			mygo.App.Exit(1)
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

func boot() error {
	resources, err := mygo.App.Path(mygo.PathResources)
	if err != nil {
		return err
	}
	base, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return err
	}
	dataDir = filepath.Join(base, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	nodeName := "node"
	if runtime.GOOS == "windows" {
		nodeName = "node.exe"
	}
	// launcher.cjs calls startServer. The bundle stays quiet when
	// AI_CANVAS_EMBEDDED=1, which is how Electron starts it too.
	cmd, url, err := startCanvasServer(
		filepath.Join(resources, "bin", nodeName),
		filepath.Join(resources, "launcher.cjs"),
		filepath.Join(resources, "dist"),
		dataDir,
	)
	if err != nil {
		return err
	}
	serverCmd = cmd
	origin = strings.TrimRight(url, "/")
	log.Println("AI Canvas", origin)
	openWindow()
	return nil
}

func openWindow() {
	win := mygo.NewWindow(mygo.WindowOptions{
		Title:           "AI Canvas",
		URL:             origin,
		Width:           1440,
		Height:          900,
		MinWidth:        800,
		MinHeight:       560,
		BackgroundColor: "#f9fafb",
		StateKey:        "main",
		Hidden:          true,
	})
	mainWindow = win
	win.OnReadyToShow(win.Show)
	win.OnClosed(func() {
		if mainWindow == win {
			mainWindow = nil
		}
	})
	page := win.Page()
	page.OnDidFailLoad(func(err *mygo.LoadError) {
		log.Println(err)
		win.Show()
	})
	page.SetPermissionHandler(func(req mygo.PermissionRequest) bool {
		return isAppURL(req.Origin, origin) || req.Origin == origin
	})
	page.OnWillNavigate(func(e *mygo.NavigateEvent) {
		if isAppURL(e.URL, origin) {
			return
		}
		e.PreventDefault()
		if strings.HasPrefix(e.URL, "http://") || strings.HasPrefix(e.URL, "https://") {
			go mygo.Shell.OpenExternal(e.URL)
		}
	})
	page.SetWindowOpenHandler(func(req mygo.WindowOpenRequest) *mygo.WindowOptions {
		if isAppURL(req.URL, origin) {
			return &mygo.WindowOptions{Width: 960, Height: 720}
		}
		go mygo.Shell.OpenExternal(req.URL)
		return nil
	})
}

func stopServer() {
	if serverCmd == nil {
		return
	}
	stopProcess(serverCmd)
	_ = serverCmd.Wait()
	serverCmd = nil
}
