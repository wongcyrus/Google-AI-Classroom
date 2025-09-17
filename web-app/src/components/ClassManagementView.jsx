import { Link } from 'react-router-dom';
import ClassManagement from './ClassManagement';

const ClassManagementView = ({ user }) => {
  return (
    <div>
      <Link to="/teacher">
        <button>Back to Teacher View</button>
      </Link>
      <ClassManagement user={user} />
    </div>
  );
};

export default ClassManagementView;
