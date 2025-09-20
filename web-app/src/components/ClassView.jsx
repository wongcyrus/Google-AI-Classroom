import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import MonitorView from './MonitorView';
import IrregularitiesView from './IrregularitiesView';
import ProgressView from './ProgressView';
import './ClassView.css';

const ClassView = ({ setTitle }) => {
  const { classId } = useParams();
  const [activeTab, setActiveTab] = useState('monitor');

  useEffect(() => {
    setTitle(`Class: ${classId}`);
  }, [classId, setTitle]);

  const renderContent = () => {
    switch (activeTab) {
      case 'monitor':
        return <MonitorView setTitle={setTitle} classId={classId} />;
      case 'progress':
        return <ProgressView classId={classId} setTitle={setTitle} />;
      case 'irregularities':
        return <IrregularitiesView />;
      default:
        return null;
    }
  };

  return (
    <div className="class-view">
        <Link to="/teacher">Back to Dashboard</Link>
        <div className="tab-nav">
            <button className={`tab-button ${activeTab === 'monitor' ? 'active' : ''}`} onClick={() => setActiveTab('monitor')}>
            Monitor
            </button>
            <button className={`tab-button ${activeTab === 'progress' ? 'active' : ''}`} onClick={() => setActiveTab('progress')}>
            Progress
            </button>
            <button className={`tab-button ${activeTab === 'irregularities' ? 'active' : ''}`} onClick={() => setActiveTab('irregularities')}>
            Irregularities
            </button>
        </div>

        <div className="tab-content">
            {renderContent()}
        </div>
    </div>
  );
};

export default ClassView;
