import { useState } from 'react';
import './CreateChoice.css';

function CreateChoice() {
  const [selected, setSelected] = useState(null);

  const contractTypes = [
    {
      id: 'rent',
      title: 'Rental Contract',
      description: 'Create a smart rental agreement with automated payments and dispute resolution',
      icon: 'fas fa-home',
      path: '/create-rent',
      color: '#6366F1'
    },
    {
      id: 'nda',
      title: 'NDA Agreement',
      description: 'Create a Non-Disclosure Agreement to protect confidential information',
      icon: 'fas fa-file-signature',
      path: '/create-nda',
      color: '#10B981'
    }
  ];

  const handleSelect = (type) => {
    setSelected(type.id);
    setTimeout(() => {
      window.location.href = type.path; // גם משנה URL וגם טוען מחדש את הדף
    }, 300);
  };

  const handleBack = () => {
    window.location.href = '/'; // חזרה לדף הבית עם רענון
  };

  return (
    <div className="create-choice-page">
      <div className="container">
        <div className="page-header">
          <h1>Create New Contract</h1>
          <p>Select the type of contract you want to create</p>
        </div>

        <div className="contract-types">
          {contractTypes.map((type) => (
            <div 
              key={type.id}
              className={`contract-card ${selected === type.id ? 'selected' : ''}`}
              onClick={() => handleSelect(type)}
              style={{ '--accent-color': type.color }}
            >
              <div className="card-icon">
                <i className={type.icon}></i>
              </div>
              <h3>{type.title}</h3>
              <p>{type.description}</p>
              <div className="select-button">
                <span>Select</span>
                <i className="fas fa-arrow-right"></i>
              </div>
            </div>
          ))}
        </div>

        <div className="back-section">
          <button 
            className="back-button" 
            onClick={handleBack}
          >
            <i className="fas fa-arrow-left"></i>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateChoice;
