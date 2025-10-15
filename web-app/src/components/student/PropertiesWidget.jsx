
import React from 'react';

const PropertiesWidget = ({ classProperties, myProperties }) => {
  return (
    <div className="properties-widget">
        <h2>Class Properties</h2>
        {classProperties && Object.keys(classProperties).length > 0 ? (
            <div className="properties-list">
                {Object.entries(classProperties).map(([key, value]) => (
                    <div key={key} className="property-item">
                        <p className="property-key">{key}</p>
                        <p className="property-value">{String(value)}</p>
                    </div>
                ))}
            </div>
        ) : (
            <p>No class-wide properties defined.</p>
        )}

        {myProperties && Object.keys(myProperties).length > 0 && (
            <>
                <h2 style={{ marginTop: '20px' }}>My Properties</h2>
                <div className="properties-list">
                    {Object.entries(myProperties).map(([key, value]) => (
                        <div key={key} className="property-item">
                            <p className="property-key">{key}</p>
                            <p className="property-value">{String(value)}</p>
                        </div>
                    ))}
                </div>
            </>
        )}
    </div>
  );
};

export default PropertiesWidget;
