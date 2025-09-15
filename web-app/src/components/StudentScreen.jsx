
import { useState, useEffect } from 'react';
import { ref, getDownloadURL, getMetadata } from 'firebase/storage';
import { storage } from '../firebase-config';

const StudentScreen = ({ student }) => {
  const [screenshotUrl, setScreenshotUrl] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const screenshotRef = ref(storage, `screenshots/${student.id}/screenshot.jpg`);

    const updateScreenshot = () => {
      getMetadata(screenshotRef).then(metadata => {
        if (lastUpdated !== metadata.updated) {
            getDownloadURL(screenshotRef).then(url => {
                setScreenshotUrl(url);
                setLastUpdated(metadata.updated);
            });
        }
      }).catch(error => {
          if (error.code === 'storage/object-not-found') {
              // This is expected, not an error to display
          } else {
              console.error(error);
          }
          setScreenshotUrl(null);
      });
    };

    const interval = setInterval(updateScreenshot, 5000);
    updateScreenshot();

    return () => clearInterval(interval);
  }, [student.id, lastUpdated]);

  return (
    <div className="student-screen">
      <h2>{student.email}</h2>
      {screenshotUrl ? (
        <img src={screenshotUrl} alt={`Screenshot from ${student.email}`} />
      ) : (
        <p>No screenshot available</p>
      )}
    </div>
  );
};

export default StudentScreen;
