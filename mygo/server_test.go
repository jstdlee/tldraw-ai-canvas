package main

import "testing"

func TestParseListenURL(t *testing.T) {
	got, ok := parseListenURL("AI canvas server on http://127.0.0.1:43123")
	if !ok || got != "http://127.0.0.1:43123" {
		t.Fatalf("got %q %v", got, ok)
	}
	if _, ok := parseListenURL("still starting"); ok {
		t.Fatal("accepted a line that is not the listen line")
	}
}

func TestIsAppURL(t *testing.T) {
	origin := "http://127.0.0.1:43123"
	if !isAppURL(origin, origin) || !isAppURL(origin+"/api/health", origin) {
		t.Fatal("local URLs must stay in the window")
	}
	if isAppURL("https://example.com", origin) || isAppURL("http://127.0.0.1:1/", origin) {
		t.Fatal("other origins must leave the window")
	}
}
