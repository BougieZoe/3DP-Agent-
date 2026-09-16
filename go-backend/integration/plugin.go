// Package integration provides the plugin architecture for 3DP Agent.
// It defines interfaces for integrating external tools and services.
package integration

import (
	"context"
	"time"
)

// PluginCapability represents what a plugin can do.
type PluginCapability string

const (
	CapabilityPrinterControl   PluginCapability = "printer.control"
	CapabilityPrinterMonitor   PluginCapability = "printer.monitor"
	CapabilityMaterialQuery    PluginCapability = "material.query"
	CapabilityMaterialRecommend PluginCapability = "material.recommend"
	CapabilityManufacturingQuote PluginCapability = "manufacturing.quote"
	CapabilityManufacturingOrder PluginCapability = "manufacturing.order"
	CapabilityCADEdit          PluginCapability = "cad.edit"
	CapabilityCADCollaborate   PluginCapability = "cad.collaborate"
	CapabilitySimulationRun    PluginCapability = "simulation.run"
	CapabilitySensorRead       PluginCapability = "sensor.read"
)

// IntegrationEvent represents an event from an integration.
type IntegrationEvent struct {
	Type      string      `json:"type"`
	Source    string      `json:"source"`
	Timestamp time.Time   `json:"timestamp"`
	Payload   interface{} `json:"payload"`
}

// EventHandler processes integration events.
type EventHandler interface {
	Handle(ctx context.Context, event IntegrationEvent) error
}

// PluginConfig holds configuration for a plugin.
type PluginConfig struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Version  string            `json:"version"`
	Endpoint string            `json:"endpoint"`
	APIKey   string            `json:"api_key,omitempty"`
	Options  map[string]string `json:"options,omitempty"`
}

// IntegrationPlugin defines the interface for all integrations.
type IntegrationPlugin interface {
	// Init initializes the plugin with configuration.
	Init(ctx context.Context, config PluginConfig) error

	// Destroy cleans up the plugin resources.
	Destroy(ctx context.Context) error

	// Capabilities returns what this plugin can do.
	Capabilities() []PluginCapability

	// HealthCheck verifies the plugin is working.
	HealthCheck(ctx context.Context) error

	// HandleEvent processes an integration event.
	HandleEvent(ctx context.Context, event IntegrationEvent) error
}

// EventBus manages plugin registration and event distribution.
type EventBus interface {
	// Register adds a plugin to the bus.
	Register(plugin IntegrationPlugin) error

	// Unregister removes a plugin from the bus.
	Unregister(pluginID string) error

	// Publish sends an event to all registered handlers.
	Publish(ctx context.Context, event IntegrationEvent) error

	// Subscribe registers a handler for specific event types.
	Subscribe(eventType string, handler EventHandler) error

	// Start begins listening for events.
	Start(ctx context.Context) error

	// Stop gracefully shuts down the event bus.
	Stop(ctx context.Context) error
}
