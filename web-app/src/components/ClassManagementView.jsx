import { Link } from 'react-router-dom';
import ClassManagement from './ClassManagement';

const ClassManagementView = ({ user }) => {

  return (
    <div>

      <ClassManagement user={user} />
    </div>
  );
};

export default ClassManagementView;
