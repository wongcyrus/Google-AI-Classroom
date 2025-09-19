import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import ClassManagement from './ClassManagement';

const ClassManagementView = ({ user, setTitle }) => {
  useEffect(() => {
    setTitle('Class Management');
  }, [setTitle]);

  return (
    <div>
      <Link to="/teacher">Back to Teacher View</Link>
      <ClassManagement user={user} />
    </div>
  );
};

export default ClassManagementView;
