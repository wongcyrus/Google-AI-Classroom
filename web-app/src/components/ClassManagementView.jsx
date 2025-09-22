import { Link } from 'react-router-dom';
import ClassManagement from './ClassManagement';

const ClassManagementView = ({ user }) => {

  return (
    <div>
      <Link to="/teacher">Back to Teacher View</Link>
      <ClassManagement user={user} />
    </div>
  );
};

export default ClassManagementView;
