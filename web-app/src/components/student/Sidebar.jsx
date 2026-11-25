import React, { useId, useState } from 'react';
import PropertiesWidget from './PropertiesWidget';
import AlertsWidget from './AlertsWidget';
import MessagesWidget from './MessagesWidget';

const Sidebar = ({
  classProperties,
  myProperties,
  recentIrregularities,
  ipAddress,
  recentMessages,
  activeTab: externalTab,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState('all'); // 'all' | 'properties' | 'messages' | 'alerts'
  const baseId = useId();
  const activeTab = externalTab !== undefined ? externalTab : internalTab;

  const handleTabClick = (tab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  const showProperties = activeTab === 'properties' || activeTab === 'all';
  const showMessages = activeTab === 'messages' || activeTab === 'all';
  const showAlerts = activeTab === 'alerts' || activeTab === 'all';

  return (
    <div className="student-view-sidebar">
      {/* Sidebar Navigation Tabs */}
      <div className="sidebar-tabs-nav" role="tablist" aria-label="Student Information Panels">
        <button
          id={`${baseId}-tab-all`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          aria-controls={`${baseId}-panel-properties ${baseId}-panel-messages ${baseId}-panel-alerts`}
          className={`sidebar-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => handleTabClick('all')}
          title="Show All Sidebar Panels"
        >
          📑 All Panels
        </button>
        <button
          id={`${baseId}-tab-properties`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'properties'}
          aria-controls={`${baseId}-panel-properties`}
          className={`sidebar-tab-btn ${activeTab === 'properties' ? 'active' : ''}`}
          onClick={() => handleTabClick('properties')}
          title="Classroom & Device Properties"
        >
          📋 Class Info
        </button>
        <button
          id={`${baseId}-tab-messages`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'messages'}
          aria-controls={`${baseId}-panel-messages`}
          className={`sidebar-tab-btn ${activeTab === 'messages' ? 'active' : ''}`}
          onClick={() => handleTabClick('messages')}
          title="Instructor Messages"
        >
          💬 Messages
        </button>
        <button
          id={`${baseId}-tab-alerts`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'alerts'}
          aria-controls={`${baseId}-panel-alerts`}
          className={`sidebar-tab-btn ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => handleTabClick('alerts')}
          title="My Recent Alerts"
        >
          🔔 Alerts
        </button>
      </div>

      {/* Panel 1: Class & Student Properties (Shown First) */}
      <div
        id={`${baseId}-panel-properties`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-properties`}
        className="sidebar-tab-panel"
        style={{ display: showProperties ? 'block' : 'none' }}
      >
        <PropertiesWidget classProperties={classProperties} myProperties={myProperties} />
      </div>

      {/* Panel 2: Messages (Shown Immediately After Class Properties) */}
      <div
        id={`${baseId}-panel-messages`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-messages`}
        className="sidebar-tab-panel"
        style={{ display: showMessages ? 'block' : 'none' }}
      >
        <MessagesWidget recentMessages={recentMessages} />
      </div>

      {/* Panel 3: Recent Alerts */}
      <div
        id={`${baseId}-panel-alerts`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-alerts`}
        className="sidebar-tab-panel"
        style={{ display: showAlerts ? 'block' : 'none' }}
      >
        <AlertsWidget recentIrregularities={recentIrregularities} ipAddress={ipAddress} />
      </div>
    </div>
  );
};

export default Sidebar;
