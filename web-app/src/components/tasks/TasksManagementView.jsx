import React, { useState, useEffect } from 'react';
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  limit,
  getDocs,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase-config';
import TaskEditorModal from './TaskEditorModal';
import TaskGradingMatrixView from './TaskGradingMatrixView';
import './tasks.css';

const TasksManagementView = ({
  classId,
  className = '',
  classSchedule,
  lessons = [],
  availableVideos = [],
  enrolledStudents = [],
  studentProfiles = {},
}) => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [selectedTaskForGrading, setSelectedTaskForGrading] = useState(null);
  const [taskSubmissions, setTaskSubmissions] = useState([]);
  const [loadedVideos, setLoadedVideos] = useState([]);

  // Fetch teacher's lecture recordings for this class if availableVideos was not provided or empty
  useEffect(() => {
    if (!classId) return;
    if (availableVideos && availableVideos.length > 0) {
      setLoadedVideos(availableVideos);
      return;
    }

    const recordingsRef = collection(db, 'classes', classId, 'lectureRecordings');
    getDocs(recordingsRef)
      .then((snap) => {
        const vids = snap.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const dateStr = data.startedAt
              ? new Date(data.startedAt).toLocaleDateString()
              : data.createdAt
              ? new Date(data.createdAt).toLocaleDateString()
              : '';
            return {
              id: docSnap.id,
              title: data.title ? `${data.title}${dateStr ? ` (${dateStr})` : ''}` : `Lecture Recording ${dateStr}`,
              videoPath: data.storagePath || data.youtubeUrl || '',
              storagePath: data.storagePath || '',
              youtubeUrl: data.youtubeUrl || '',
              youtubeVideoId: data.youtubeVideoId || '',
              durationSeconds: data.durationSeconds || 0,
              isTeacherRecording: true,
              ...data,
            };
          })
          .filter((v) => v.videoPath || v.storagePath || v.youtubeUrl);
        setLoadedVideos(vids);
      })
      .catch((err) => {
        console.debug('Failed to fetch teacher lecture recordings for task editor:', err);
      });
  }, [classId, availableVideos]);

  // Subscribe to tasks in the class
  useEffect(() => {
    if (!classId) return;
    setLoading(true);

    const tasksRef = collection(db, 'classes', classId, 'tasks');
    const unsubscribe = onSnapshot(
      tasksRef,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setTasks(list);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching tasks:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [classId]);

  // Subscribe to submissions when viewing grading matrix
  useEffect(() => {
    if (!classId || !selectedTaskForGrading) {
      setTaskSubmissions([]);
      return;
    }

    const subsRef = collection(
      db,
      'classes',
      classId,
      'tasks',
      selectedTaskForGrading.id,
      'submissions'
    );
    const unsubscribe = onSnapshot(subsRef, (snapshot) => {
      const subs = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        studentUid: docSnap.id,
        ...docSnap.data(),
      }));
      setTaskSubmissions(subs);
    });

    return () => unsubscribe();
  }, [classId, selectedTaskForGrading]);

  const handleCreateTask = () => {
    setEditingTask(null);
    setIsEditorOpen(true);
  };

  const handleEditTask = (task) => {
    setEditingTask(task);
    setIsEditorOpen(true);
  };

  const handleSaveTask = async (taskPayload) => {
    if (!classId) return;

    if (editingTask && editingTask.id) {
      const taskDocRef = doc(db, 'classes', classId, 'tasks', editingTask.id);
      await updateDoc(taskDocRef, {
        ...taskPayload,
        updatedAt: new Date(),
      });
    } else {
      const tasksRef = collection(db, 'classes', classId, 'tasks');
      const newTaskDocRef = doc(tasksRef);
      await setDoc(newTaskDocRef, {
        ...taskPayload,
        status: 'published',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm('Are you sure you want to delete this practical task?')) return;
    try {
      await deleteDoc(doc(db, 'classes', classId, 'tasks', taskId));
    } catch (err) {
      console.error('Failed to delete task:', err);
      alert('Failed to delete task: ' + err.message);
    }
  };

  const handleToggleTaskStatus = async (task) => {
    const nextStatus = task.status === 'published' ? 'closed' : 'published';
    try {
      await updateDoc(doc(db, 'classes', classId, 'tasks', task.id), {
        status: nextStatus,
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error('Failed to toggle task status:', err);
    }
  };

  const handleSaveOverride = async (studentUid, overrideData) => {
    if (!classId || !selectedTaskForGrading) return;
    try {
      const subRef = doc(
        db,
        'classes',
        classId,
        'tasks',
        selectedTaskForGrading.id,
        'submissions',
        studentUid
      );
      await updateDoc(subRef, {
        teacherOverride: overrideData,
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error('Failed to save score override:', err);
      alert('Failed to save override: ' + err.message);
    }
  };

  const handleTriggerEvaluation = async (studentUid, attemptNumber = 1) => {
    if (!classId || !selectedTaskForGrading) return;
    try {
      const evaluateFn = httpsCallable(functions, 'evaluateTaskSubmission');
      const res = await evaluateFn({
        classId,
        taskId: selectedTaskForGrading.id,
        studentUid,
        attemptNumber,
        rubricSteps: selectedTaskForGrading.rubricSteps || [],
        model: selectedTaskForGrading.model || 'gemini-3.7-flash',
      });
      return res.data;
    } catch (err) {
      console.error('Failed to trigger task evaluation:', err);
      throw err;
    }
  };

  // If viewing grading matrix, render matrix sub-view
  if (selectedTaskForGrading) {
    return (
      <TaskGradingMatrixView
        task={selectedTaskForGrading}
        classId={classId}
        className={className || classId}
        lessons={lessons}
        submissions={taskSubmissions}
        enrolledStudents={enrolledStudents}
        studentProfiles={studentProfiles}
        onBack={() => setSelectedTaskForGrading(null)}
        onSaveOverride={handleSaveOverride}
        onTriggerEvaluation={handleTriggerEvaluation}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div>
          <h2 className="text-2xl font-black text-gray-900 flex items-center gap-2">
            <span>📋</span> Practical Tasks & Homework
          </h2>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Create hands-on lab challenges with reference demo videos. Evaluate student screen recordings automatically with Gemini 3.7 Flash.
          </p>
        </div>

        <button
          onClick={handleCreateTask}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md flex items-center gap-2 transition-all self-start sm:self-auto"
        >
          <span>+</span>
          <span>Create Practical Task</span>
        </button>
      </div>

      {/* Task Cards Grid */}
      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-gray-200 space-y-4">
          <div className="text-4xl">📝</div>
          <h3 className="text-lg font-bold text-gray-800">
            No Practical Tasks Created Yet
          </h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            Add hands-on lab assignments or homework. Attach demo clips and define rubric milestones for automated AI invigilation and grading.
          </p>
          <button
            onClick={handleCreateTask}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow inline-flex items-center gap-1.5"
          >
            <span>+</span> Create First Task
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tasks.map((task) => {
            const timing = task.constraints?.timing || {};
            const attempts = task.constraints?.attempts || {};
            const deadline = timing.deadline?.toDate
              ? timing.deadline.toDate()
              : timing.deadline
              ? new Date(timing.deadline)
              : null;

            return (
              <div
                key={task.id}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between overflow-hidden"
              >
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        task.scheduleMode === 'homework'
                          ? 'bg-purple-100 text-purple-700'
                          : task.scheduleMode === 'in_class'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {task.scheduleMode === 'homework'
                        ? '🏠 Homework'
                        : task.scheduleMode === 'in_class'
                        ? '🏫 In-Class'
                        : '🔄 Flexible'}
                    </span>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        task.status === 'published'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {task.status === 'published' ? 'Active' : 'Closed'}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-gray-900 line-clamp-1">
                    {task.title}
                  </h3>

                  <p className="text-xs text-gray-500 line-clamp-2">
                    {task.description || 'No instructions provided.'}
                  </p>

                  <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs text-gray-700">
                    <div>
                      <span className="text-gray-400 block text-[10px]">Max Score</span>
                      <span className="font-bold">{task.maxScore || 100} pts</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px]">Time Limit</span>
                      <span className="font-bold">
                        {timing.timeLimitMinutes ? `${timing.timeLimitMinutes} mins` : 'Unlimited'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px]">Attempts</span>
                      <span className="font-bold">
                        {attempts.maxAttempts ? `${attempts.maxAttempts} allowed` : 'Unlimited'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[10px]">Deadline</span>
                      <span className="font-bold">
                        {deadline ? deadline.toLocaleDateString() : 'None'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setSelectedTaskForGrading(task)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1"
                  >
                    <span>📊</span>
                    <span>Grading Matrix</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleTaskStatus(task)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 text-xs"
                      title={task.status === 'published' ? 'Close task' : 'Activate task'}
                    >
                      {task.status === 'published' ? '🔒' : '🚀'}
                    </button>
                    <button
                      onClick={() => handleEditTask(task)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 text-xs"
                      title="Edit task"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 text-xs"
                      title="Delete task"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Modal */}
      <TaskEditorModal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveTask}
        initialTask={editingTask}
        classId={classId}
        classSchedule={classSchedule}
        availableVideos={loadedVideos.length > 0 ? loadedVideos : availableVideos}
      />
    </div>
  );
};

export default TasksManagementView;
