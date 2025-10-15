
import React from 'react';
import PropertiesWidget from './PropertiesWidget';
import AlertsWidget from './AlertsWidget';
import MessagesWidget from './MessagesWidget';

const Sidebar = ({ classProperties, myProperties, recentIrregularities, ipAddress, recentMessages }) => {
  return (
    <div className="student-view-sidebar">
        <PropertiesWidget classProperties={classProperties} myProperties={myProperties} />
        <AlertsWidget recentIrregularities={recentIrregularities} ipAddress={ipAddress} />
        <MessagesWidget recentMessages={recentMessages} />
    </div>
  );
};

export default Sidebar;
